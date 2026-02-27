import { Hono } from 'hono';
import { nanoid } from 'nanoid';

export const pairRoutes = new Hono();

interface PairRoom {
  id: string;
  conversationId: string;
  createdAt: number;
  hostName: string;
  observers: Set<string>;
  eventBuffer: string[];
}

const rooms = new Map<string, PairRoom>();
const roomEmitters = new Map<string, Set<(event: string) => void>>();

// Auto-cleanup rooms older than 2 hours with no observers every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    const twoHours = 2 * 60 * 60 * 1000;
    for (const [id, room] of rooms.entries()) {
      if (now - room.createdAt > twoHours && room.observers.size === 0) {
        rooms.delete(id);
        roomEmitters.delete(id);
      }
    }
  },
  5 * 60 * 1000,
);

function emit(roomId: string, event: string, data: any) {
  const room = rooms.get(roomId);
  if (!room) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  // Buffer last 50 events
  room.eventBuffer.push(payload);
  if (room.eventBuffer.length > 50) {
    room.eventBuffer.shift();
  }

  // Notify all active SSE subscribers
  const emitters = roomEmitters.get(roomId);
  if (emitters) {
    for (const fn of emitters) {
      try {
        fn(payload);
      } catch {
        // subscriber gone
      }
    }
  }
}

// POST /pair/rooms — create room
pairRoutes.post('/rooms', async (c) => {
  let body: { conversationId: string; hostName: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { conversationId, hostName } = body;
  if (!conversationId) return c.json({ ok: false, error: 'conversationId is required' }, 400);
  if (!hostName) return c.json({ ok: false, error: 'hostName is required' }, 400);

  const roomId = nanoid(10);
  const room: PairRoom = {
    id: roomId,
    conversationId,
    createdAt: Date.now(),
    hostName,
    observers: new Set(),
    eventBuffer: [],
  };

  rooms.set(roomId, room);
  roomEmitters.set(roomId, new Set());

  return c.json(
    {
      ok: true,
      data: {
        roomId,
        shareUrl: `/pair/rooms/${roomId}`,
      },
    },
    201,
  );
});

// GET /pair/rooms/:id — get room info
pairRoutes.get('/rooms/:id', (c) => {
  const { id } = c.req.param();
  const room = rooms.get(id);
  if (!room) return c.json({ ok: false, error: 'Room not found' }, 404);

  return c.json({
    ok: true,
    data: {
      id: room.id,
      conversationId: room.conversationId,
      hostName: room.hostName,
      observerCount: room.observers.size,
      createdAt: room.createdAt,
    },
  });
});

// POST /pair/rooms/:id/join — add observer
pairRoutes.post('/rooms/:id/join', async (c) => {
  const { id } = c.req.param();
  const room = rooms.get(id);
  if (!room) return c.json({ ok: false, error: 'Room not found' }, 404);

  let body: { observerName: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { observerName } = body;
  if (!observerName) return c.json({ ok: false, error: 'observerName is required' }, 400);

  room.observers.add(observerName);
  emit(id, 'joined', { type: 'joined', name: observerName });

  return c.json({ ok: true });
});

// POST /pair/rooms/:id/broadcast — broadcast custom event
pairRoutes.post('/rooms/:id/broadcast', async (c) => {
  const { id } = c.req.param();
  const room = rooms.get(id);
  if (!room) return c.json({ ok: false, error: 'Room not found' }, 404);

  let body: { event: string; data: any };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { event, data } = body;
  if (!event) return c.json({ ok: false, error: 'event is required' }, 400);

  emit(id, event, data);
  return c.json({ ok: true });
});

// DELETE /pair/rooms/:id — close room
pairRoutes.delete('/rooms/:id', (c) => {
  const { id } = c.req.param();
  if (!rooms.has(id)) return c.json({ ok: false, error: 'Room not found' }, 404);

  // Notify observers room is closing
  emit(id, 'closed', { type: 'closed' });

  rooms.delete(id);
  roomEmitters.delete(id);

  return c.json({ ok: true });
});

// GET /pair/rooms/:id/stream — SSE stream for observers
pairRoutes.get('/rooms/:id/stream', (c) => {
  const { id } = c.req.param();
  const room = rooms.get(id);
  if (!room) return c.json({ ok: false, error: 'Room not found' }, 404);

  const emitters = roomEmitters.get(id)!;

  const encoder = new TextEncoder();
  let closed = false;
  let controller: ReadableStreamDefaultController | null = null;

  // We'll collect the emitter function so we can remove it on close
  let emitFn: (event: string) => void;

  const stream = new ReadableStream({
    start(ctrl) {
      controller = ctrl;

      // Replay buffered events for late joiners
      for (const buffered of room.eventBuffer) {
        ctrl.enqueue(encoder.encode(buffered));
      }

      // Send an initial ping to confirm connection
      ctrl.enqueue(encoder.encode(': ping\n\n'));

      // Register the emitter
      emitFn = (payload: string) => {
        if (!closed && controller) {
          try {
            controller.enqueue(encoder.encode(payload));
          } catch {
            closed = true;
            emitters.delete(emitFn);
          }
        }
      };
      emitters.add(emitFn);
    },
    cancel() {
      closed = true;
      if (emitFn) emitters.delete(emitFn);
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
