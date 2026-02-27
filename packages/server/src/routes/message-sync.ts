import { Hono } from 'hono';
import { EventEmitter } from 'events';

const app = new Hono();

/**
 * Global event emitter for cross-device message synchronization.
 * Persists across Bun --hot reloads.
 */
const GLOBAL_KEY = '__e_messageSyncEmitter';
const messageSyncEmitter: EventEmitter =
  (globalThis as any)[GLOBAL_KEY] ?? ((globalThis as any)[GLOBAL_KEY] = new EventEmitter());

/**
 * Broadcast a message update event to all connected clients listening to a conversation.
 * Called from the message persistence code when messages are inserted/updated.
 */
export function broadcastMessageUpdate(conversationId: string, messageId: string, role: string) {
  messageSyncEmitter.emit('message:updated', {
    conversationId,
    messageId,
    role,
    timestamp: Date.now(),
  });
}

/**
 * SSE endpoint for real-time message synchronization.
 * Clients subscribe to this stream for a specific conversation and receive
 * instant notifications when messages are added or updated, enabling
 * sub-second cross-device synchronization.
 *
 * GET /message-sync/:conversationId
 *
 * Returns an SSE stream with events:
 *   - message_updated: { conversationId, messageId, role, timestamp }
 *   - ping: keepalive heartbeat
 */
app.get('/:conversationId', (c) => {
  const conversationId = c.req.param('conversationId');
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Handler for message update events
      const handler = (event: {
        conversationId: string;
        messageId: string;
        role: string;
        timestamp: number;
      }) => {
        if (event.conversationId === conversationId) {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'message_updated', ...event })}\n\n`),
            );
          } catch {
            /* client disconnected */
          }
        }
      };

      // Subscribe to message updates
      messageSyncEmitter.on('message:updated', handler);

      // Keepalive ping every 15 seconds
      const pingInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`data: {"type":"ping"}\n\n`));
        } catch {
          clearInterval(pingInterval);
        }
      }, 15000);

      // Cleanup on client disconnect
      c.req.raw.signal.addEventListener('abort', () => {
        messageSyncEmitter.off('message:updated', handler);
        clearInterval(pingInterval);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

export { app as messageSyncRoutes };
