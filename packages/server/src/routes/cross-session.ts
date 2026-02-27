import { Hono } from 'hono';
import { crossSessionService } from '../services/cross-session';
import type { CrossSessionSendInput } from '@e/shared';

const app = new Hono();

// ─── List active sessions for cross-session communication (AC 1) ─────────────

/**
 * GET /api/cross-session/sessions
 *
 * Lists active and recent conversations that can participate in
 * cross-session messaging. Used by agents via the list_sessions tool.
 */
app.get('/sessions', (c) => {
  const excludeId = c.req.query('exclude');

  try {
    const sessions = crossSessionService.listSessions(excludeId || undefined);
    return c.json({ ok: true, data: sessions });
  } catch (err) {
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to list sessions' },
      500,
    );
  }
});

// ─── Send a message to another session (AC 2) ────────────────────────────────

/**
 * POST /api/cross-session/send
 *
 * Sends a cross-session message from one conversation to another.
 * Validates permissions and rate limits.
 */
app.post('/send', async (c) => {
  const body = (await c.req.json()) as CrossSessionSendInput & { fromConversationId: string };

  if (!body.fromConversationId || !body.toConversationId || !body.content) {
    return c.json(
      { ok: false, error: 'fromConversationId, toConversationId, and content are required' },
      400,
    );
  }

  if (body.fromConversationId === body.toConversationId) {
    return c.json({ ok: false, error: 'Cannot send a message to the same conversation' }, 400);
  }

  try {
    const message = crossSessionService.sendMessage(
      body.fromConversationId,
      body.toConversationId,
      body.content,
    );
    return c.json({ ok: true, data: message }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to send message';

    if (msg.includes('not found')) {
      return c.json({ ok: false, error: msg }, 404);
    }
    if (msg.includes('permission') || msg.includes('does not accept')) {
      return c.json({ ok: false, error: msg }, 403);
    }
    if (msg.includes('Rate limit')) {
      return c.json({ ok: false, error: msg }, 429);
    }
    if (msg.includes('exceeds maximum length')) {
      return c.json({ ok: false, error: msg }, 400);
    }

    return c.json({ ok: false, error: msg }, 500);
  }
});

// ─── Get undelivered messages for a conversation ─────────────────────────────

/**
 * GET /api/cross-session/messages/:conversationId
 *
 * Returns undelivered cross-session messages for a conversation.
 * These are messages sent by other agents that haven't been consumed yet.
 */
app.get('/messages/:conversationId', (c) => {
  const conversationId = c.req.param('conversationId');

  try {
    const messages = crossSessionService.getUndeliveredMessages(conversationId);
    return c.json({ ok: true, data: messages });
  } catch (err) {
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to get messages' },
      500,
    );
  }
});

// ─── Mark a message as delivered ─────────────────────────────────────────────

/**
 * POST /api/cross-session/messages/:messageId/delivered
 *
 * Marks a cross-session message as delivered/consumed.
 */
app.post('/messages/:messageId/delivered', (c) => {
  const messageId = c.req.param('messageId');

  try {
    crossSessionService.markDelivered(messageId);
    return c.json({ ok: true });
  } catch (err) {
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to mark delivered' },
      500,
    );
  }
});

// ─── Get message history for a conversation ──────────────────────────────────

/**
 * GET /api/cross-session/history/:conversationId
 *
 * Returns cross-session message history (sent and received).
 */
app.get('/history/:conversationId', (c) => {
  const conversationId = c.req.param('conversationId');
  const direction = (c.req.query('direction') as 'sent' | 'received' | 'both') || 'both';
  const limit = parseInt(c.req.query('limit') || '50', 10);

  try {
    const messages = crossSessionService.getHistory(conversationId, { direction, limit });
    return c.json({ ok: true, data: messages });
  } catch (err) {
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to get history' },
      500,
    );
  }
});

// ─── Get recent cross-session message flow (for Manager View, AC 4) ──────────

/**
 * GET /api/cross-session/flow
 *
 * Returns recent cross-session messages across all conversations.
 * Used by the Manager View to display inter-agent message flow.
 */
app.get('/flow', (c) => {
  const sinceStr = c.req.query('since');
  const since = sinceStr ? parseInt(sinceStr, 10) : undefined;

  try {
    const messages = crossSessionService.getRecentFlow(since);
    return c.json({ ok: true, data: messages });
  } catch (err) {
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to get flow' },
      500,
    );
  }
});

// ─── SSE stream for real-time cross-session messages ─────────────────────────

/**
 * GET /api/cross-session/events/:conversationId
 *
 * SSE stream that delivers cross-session messages to a conversation in real time.
 * The client subscribes when a conversation is active and receives messages
 * sent by other agents.
 */
app.get('/events/:conversationId', (c) => {
  const conversationId = c.req.param('conversationId');
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Client disconnected
        }
      };

      // Send initial ping
      send({ type: 'ping', ts: Date.now() });

      // Send any undelivered messages immediately
      try {
        const undelivered = crossSessionService.getUndeliveredMessages(conversationId);
        for (const msg of undelivered) {
          send({ type: 'cross_session_message', message: msg });
        }
      } catch {
        // Ignore errors on initial load
      }

      // Listen for new messages
      const onMessage = (message: any) => {
        send({ type: 'cross_session_message', message });
      };

      crossSessionService.events.on(`message:${conversationId}`, onMessage);

      // Keepalive ping
      const pingInterval = setInterval(() => {
        send({ type: 'ping', ts: Date.now() });
      }, 20000);

      // Cleanup on disconnect
      const cleanup = () => {
        clearInterval(pingInterval);
        crossSessionService.events.off(`message:${conversationId}`, onMessage);
      };

      c.req.raw.signal?.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

// ─── SSE stream for Manager View — all cross-session messages ────────────────

/**
 * GET /api/cross-session/events
 *
 * Global SSE stream of all cross-session messages.
 * Used by the Manager View to show inter-agent message flow (AC 4).
 */
app.get('/events', (c) => {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Client disconnected
        }
      };

      // Send initial ping
      send({ type: 'ping', ts: Date.now() });

      // Listen for all cross-session messages
      const onMessage = (message: any) => {
        send({ type: 'cross_session_message', message });
      };

      crossSessionService.events.on('message', onMessage);

      // Keepalive ping
      const pingInterval = setInterval(() => {
        send({ type: 'ping', ts: Date.now() });
      }, 20000);

      // Cleanup on disconnect
      const cleanup = () => {
        clearInterval(pingInterval);
        crossSessionService.events.off('message', onMessage);
      };

      c.req.raw.signal?.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

export { app as crossSessionRoutes };
