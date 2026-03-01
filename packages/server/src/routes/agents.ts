import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { AgentKernel } from '../services/agent-kernel';
import { upgradeWebSocket } from '../ws';

const app = new Hono();

/**
 * WebSocket route for "E Link" — allows a CLI/Client to connect to a shared Kernel session.
 */
app.get(
  '/ws/:sessionId',
  upgradeWebSocket((c) => {
    const sessionId = c.req.param('sessionId');
    const kernel = new AgentKernel({ sessionId });

    return {
      onOpen(_event, ws) {
        console.log(`[kernel:ws] Connection opened for session ${sessionId}`);

        kernel.on('event', (ev) => {
          ws.send(JSON.stringify(ev));
        });

        ws.send(JSON.stringify({ type: 'init', sessionId }));
      },
      onMessage(event, ws) {
        const data = JSON.parse(String(event.data));

        if (data.type === 'run') {
          kernel.run(data.prompt, data.model).catch((err) => {
            ws.send(JSON.stringify({ type: 'error', data: { message: err.message } }));
          });
        }
      },
      onClose() {
        console.log(`[kernel:ws] Connection closed for session ${sessionId}`);
        kernel.removeAllListeners();
      },
    };
  }),
);

// In-memory tracking for background agents
const agents = new Map<string, any>();

// List agents
app.get('/', (c) => {
  const parentSession = c.req.query('parentSessionId');
  let list = Array.from(agents.values());
  if (parentSession) {
    list = list.filter((a) => a.parentSessionId === parentSession);
  }
  return c.json({ ok: true, data: list });
});

// Spawn agent (Direct POST)
app.post('/', async (c) => {
  const body = await c.req.json();
  const agentId = nanoid();
  const sessionId = body.sessionId || nanoid();

  const agent = {
    id: agentId,
    type: body.type || 'general-purpose',
    description: body.description,
    status: 'running',
    sessionId,
    parentSessionId: body.parentSessionId || '',
    spawnedAt: Date.now(),
  };

  agents.set(agentId, agent);

  // Background execution using the Kernel
  (async () => {
    try {
      const kernel = new AgentKernel({ sessionId, workspacePath: body.workspacePath });
      const result = await kernel.run(body.prompt, body.model);

      const a = agents.get(agentId);
      if (a) {
        a.status = 'completed';
        a.completedAt = Date.now();
        a.result = result;
      }
    } catch (err) {
      const a = agents.get(agentId);
      if (a) {
        a.status = 'error';
        a.completedAt = Date.now();
        a.error = String(err);
      }
    }
  })();

  return c.json({ ok: true, data: { agentId, sessionId } }, 201);
});

// Get agent status
app.get('/:id', (c) => {
  const agent = agents.get(c.req.param('id'));
  if (!agent) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: agent });
});

export { app as agentRoutes };
