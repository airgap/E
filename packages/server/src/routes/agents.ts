import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { claudeManager } from '../services/claude-process';

const app = new Hono();

// Agent tracking (in-memory since agents are ephemeral)
const agents = new Map<
  string,
  {
    id: string;
    type: string;
    description: string;
    status: string;
    sessionId: string;
    parentSessionId: string;
    spawnedAt: number;
    completedAt?: number;
    result?: string;
    error?: string;
  }
>();

// List agents
app.get('/', (c) => {
  const parentSession = c.req.query('parentSessionId');
  let list = Array.from(agents.values());
  if (parentSession) {
    list = list.filter((a) => a.parentSessionId === parentSession);
  }
  return c.json({ ok: true, data: list });
});

// Spawn agent
app.post('/', async (c) => {
  const body = await c.req.json();
  const agentId = nanoid();

  const sessionId = await claudeManager.createSession(body.parentConversationId || '', {
    model: body.model,
    workspacePath: body.workspacePath,
  });

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

  // Run agent asynchronously
  (async () => {
    try {
      const stream = await claudeManager.sendMessage(sessionId, body.prompt);
      const reader = stream.getReader();
      let result = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += new TextDecoder().decode(value);
      }

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

// Cancel agent
app.post('/:id/cancel', (c) => {
  const agent = agents.get(c.req.param('id'));
  if (!agent) return c.json({ ok: false, error: 'Not found' }, 404);

  claudeManager.cancelGeneration(agent.sessionId);
  agent.status = 'cancelled';
  agent.completedAt = Date.now();

  return c.json({ ok: true });
});

export { app as agentRoutes };
